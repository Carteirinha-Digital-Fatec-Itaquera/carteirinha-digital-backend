import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt'
import TestAgent from 'supertest/lib/agent';


@Injectable()
export class HashContentService{

    private readonly SALT_ROUNDS = 10;
    async hashContent(password?: string, content?:string):Promise<string>{
        const valuesToHash = password || content
        if (!valuesToHash){
            return "valor invalido"
        }
        
        const values = bcrypt.hash(valuesToHash, this.SALT_ROUNDS);
        return values;
    }
    async compareHash( valuesToCompare:string, password?:string, content?:string):Promise<boolean>{
        const valuesComparreHash = password || content
        // console.log(`\n\n${valuesComparreHash}\n${password}`)
        if(!valuesComparreHash){
            console.log("valor invalido ou nulo")
            return false
        }
    
        return bcrypt.compare(valuesComparreHash, valuesToCompare)
        // console.log("verficação relizada com sucesso")
        // return true
    }
}


// const value = new HashContent()

// async function testBcrypt() {
//     let passwordTeste = 'jhon'
//     try{
//         const res = await value.hashPassowrd(passwordTeste)
//         console.log(res)
//     }catch(error){
//         console.log(error)
//     }
// }
