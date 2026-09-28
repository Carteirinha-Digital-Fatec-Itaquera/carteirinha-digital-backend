export type UserRole = 'student' | 'secretary';

export interface TokenPayload {
  sub: string | number;
  role: UserRole;
  accountId?: string;
  email?: string;
  firstLogin?: boolean;
  isExpired?: boolean;
}
