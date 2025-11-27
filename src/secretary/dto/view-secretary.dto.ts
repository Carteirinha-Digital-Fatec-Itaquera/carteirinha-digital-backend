export class ViewSecretaryDTO {
  constructor(
    name: string,
    email: string,
  ) {
    this.name = name;
    this.email = email;
  }

  name: string;
  email: string;
}
