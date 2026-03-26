export class SecretaryEntity {
  constructor(id: number, name: string, email: string, password: string) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.password = password;
  }

  id: number;
  name: string;
  email: string;
  password: string;
}
