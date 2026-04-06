import { Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'


@Injectable()
export class RandomContentService{
    async generateNewPasswordRandom(length_passowrd:number = 8 ):Promise<string>{
        const newPassword:string =randomBytes(length_passowrd).toString('hex').slice(0, length_passowrd)        
        return newPassword
    }
}