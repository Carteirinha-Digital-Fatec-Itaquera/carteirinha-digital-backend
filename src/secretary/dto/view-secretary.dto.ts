export class ViewSecretaryDTO {
  constructor(id: number, name: string, email: string, birthDate: Date, dueDate: string) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.birthDate = birthDate;
    this.dueDate = dueDate;
  }
  id: number;
  name: string;
  email: string;
  birthDate: Date;
  dueDate: string;
}