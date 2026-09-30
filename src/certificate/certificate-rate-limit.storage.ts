interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export class CertificateRateLimitStorage {
  private static readonly MAX_KEYS = 20000;
  private readonly store = new Map<string, RateLimitRecord>();

  /**
   * Incrementa o contador para uma chave e verifica se está dentro do limite.
   */
  public checkAndIncrement(
    key: string,
    limit: number,
    ttlMs: number = 60000,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    this.cleanExpired(now);

    const record = this.store.get(key);

    if (record) {
      if (now >= record.resetAt) {
        // Expirou, reinicia contador
        record.count = 1;
        record.resetAt = now + ttlMs;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (record.count >= limit) {
        const retryAfter = Math.max(
          1,
          Math.ceil((record.resetAt - now) / 1000),
        );
        return { allowed: false, retryAfterSeconds: retryAfter };
      }

      record.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    // Chave nova: verificar capacidade máxima do storage
    if (this.store.size >= CertificateRateLimitStorage.MAX_KEYS) {
      // Esgotamento retorna 429 sem descartar contadores ativos
      return { allowed: false, retryAfterSeconds: 60 };
    }

    this.store.set(key, {
      count: 1,
      resetAt: now + ttlMs,
    });

    return { allowed: true, retryAfterSeconds: 0 };
  }

  public reset(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }

  private cleanExpired(now: number): void {
    // Limpeza rápida se o tamanho estiver próximo da capacidade ou esporadicamente
    if (this.store.size > 1000) {
      for (const [k, v] of this.store.entries()) {
        if (now >= v.resetAt) {
          this.store.delete(k);
        }
      }
    }
  }
}

export const certificateRateLimitStorage = new CertificateRateLimitStorage();
