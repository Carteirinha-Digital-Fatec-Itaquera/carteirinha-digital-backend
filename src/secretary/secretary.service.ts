import { Injectable, NotFoundException } from '@nestjs/common';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { SecretaryEntity } from './model/secretary.entity';
import { CreateSecretaryDTO } from './dto/create-secretary.dto';


//importação recomendada para uso
// import { secretaryRepository } from './repository/secretary.repository';



@Injectable()
export class SecretaryService {
  //Recomendação: 
  // constructor(private readonly mapper: SecretaryMapper, private readonly repository: secretaryRepository) {}
  constructor(private readonly mapper: SecretaryMapper) {}

  //Recomendo eliminação desta lsita local
  // a lista já será instanciada no construtor da classe com o nome repositry para melhor aplicaçõa
  // comentar a linha: " private list: SecretayEntity[] =[]; "
  private list: SecretaryEntity[] = [];

  // Com as recomendações feitas acima, recomendado alterar o modelo de aplicação
  // para modelo de estrutura async XDXD


  //recomnedação: 
  // async getSecretary(): Promise<SecretaryEntity> {
  getSecretary(): SecretaryEntity[] {
    // return (await this.repository.findAll()).map((secretary)=>secretary);
    return this.list.map((secretary) => secretary);
  }

  //async getSecretaryById(id: number):Promise<SecretaryERe>{}
  getSecretaryById(id: string): SecretaryEntity {
    // Realizar alteração no modelo de aplicação, dado que estpa usando operações de lista para 
    // buscar no banco de dados
    // --exc-com: oq é isso !!!!! :/ -> :C
    // const result = this.repository.findById((secretary) => secretary.id == id);
    const result = this.list.find((secretary) => secretary.id == id);
    if (result == undefined) {
      throw new NotFoundException('Secretaria não encontrada');
    }
    return result;
  }


  // async getSecretaryByEmail(email: string): Promise<SecretaryEntity> {
  getSecretaryByEmail(email: string): SecretaryEntity {

    //Novamente operações de busca no banco de dados usando operadores de lista(array)
    //alterar para
    // const result = this.repository.findByEmail((secretary) => secretary.email === email);
    const result = this.list.find((secretary) => secretary.email === email);

    if (!result) {
      throw new NotFoundException(
        `Secretaria com email '${email}' não encontrada`,
      );
    }
    return result;
  }

  // diferença do service de criação do usuário do tipo estudante
  // Instância de uma lista dentro do sistema para armazenar a operação de criação de estudante
  // Não aplicação no banco de dados, dado que está sendo armazenado apenas no sistema na array
  // nomeada como list presente em secretary.service.ts
  
  // async createSecretary(secretary: CreateSecretaryDTO) {
  createSecretary(secretary: CreateSecretaryDTO) {
    this.list.push(this.mapper.toEntity(secretary));
    // Recomendação do usuário: d-MMM-b
    // await this.list.push(this.mapper.toEntity(secretary));
  }
}
