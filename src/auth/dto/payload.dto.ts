export type UserRole = 'student' | 'secretary' | 'employee';

export interface TokenPayload {
  sub: string | number;
  role: UserRole;
  accountId?: string;
  authVersion?: number;
  email?: string;
  firstLogin?: boolean;
  isExpired?: boolean;
}
