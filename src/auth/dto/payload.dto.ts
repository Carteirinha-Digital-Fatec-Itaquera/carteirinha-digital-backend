export interface TokenPayload {
  sub: string | number;
  role: string;
  firstLogin: boolean;
  isExpired?: boolean;
}