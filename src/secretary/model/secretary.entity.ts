export class SecretaryEntity {
  
  //Resolução possivel: Retirarda do parametro id do tipo String, dado que 
  //o banco de dados já possui um id do tipo int que é  auto increment
  //Retirar parametro de inicio id, dado que o banco de dados está registrado como
  //autoincremnt()
  constructor(id: string, name: string, email: string, password: string) {
    //Recomndo comentar o valor: this.id = id
    this.id = id;
    this.name = name;
    this.email = email;
    this.password = password;
  }
  //Retirar id:Stirng
  id: string;
  name: string;
  email: string;
  password: string;
}
