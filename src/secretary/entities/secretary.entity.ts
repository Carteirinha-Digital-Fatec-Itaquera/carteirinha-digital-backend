export class SecretaryEntity {
  constructor(
    id: number,
    name: string,
    email: string,
    dueDate: Date,
    password: string,
  ) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.dueDate = dueDate;
    this.password = password;
  }

  id: number;
  name: string;
  email: string;
  dueDate: Date;
  password: string;
}
