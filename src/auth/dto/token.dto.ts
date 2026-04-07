export class TokenDTO {
  token: string;
  mustChangePassword?: boolean;
  message?: string;

  constructor(token: string, mustChangePassword = false, message?: string) {
    this.token = token;
    this.mustChangePassword = mustChangePassword;
    this.message = message;
  }
}