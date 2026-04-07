export class SecretaryEntity {
  constructor(
    id: number,
    name: string,
    email: string,
    dueDate: Date,
    password: string,
    birthDate: Date,
    lastLogin?: Date|null
    
  ) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.dueDate = dueDate;
    this.password = password;
    this.birthDate = birthDate;
    this.lastLogin = lastLogin;
  }

  id: number;
  name: string;
  email: string;
  dueDate: Date;
  password: string;
  birthDate: Date
  lastLogin?: Date|null

}
