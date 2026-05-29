import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SecretaryService } from '../../src/secretary/secretary.service';
import { StudentService } from '../../src/student/student.service';
import { HashContentService } from '../../src/utils/hashContentService';
import { TokenPayload } from './dto/payload.dto';
import { MailService } from 'src/utils/mailService';
import { VerificationService } from '../verification/verification.service';

import { NotFoundException } from '@nestjs/common';

@Injectable()
export class AuthService {
  constructor(
    private readonly studentService: StudentService,
    private readonly secretaryService: SecretaryService,
    private readonly jwtService: JwtService,
    private readonly hashService: HashContentService,
    private readonly mailService: MailService,
    private readonly verificationService: VerificationService,
  ) {}

  async signInStudent(email: string, pass: string) {
    const student = await this.studentService.getStudentByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';

    if (!student) throw new UnauthorizedException(messageError);

    if (!student.password) {
      throw new ConflictException('A senha desta conta ainda não foi definida');
    }

    const isValidPassword = await this.hashService.compareHash(student.password, pass);
    if (!isValidPassword) throw new UnauthorizedException(messageError);

    const isFirstLogin = student.lastLogin === null;

    // FIX: atualiza o timestamp sempre (antes era !isFirstLogin, causando bug)
    if(student.lastLogin){
      await this.setLoginTimestampStudent(student.ra);
    }

    const payload: TokenPayload = {
      sub: student.ra,
      role: 'student',
      firstLogin: isFirstLogin,
    };

    const token = await this.jwtService.signAsync(payload);
    return { accessToken: token, firstLogin: isFirstLogin };
  }

  async signInSecretary(email: string, pass: string) {
    const secretary = await this.secretaryService.getSecretaryByEmail(email);
    const messageError = 'O e-mail ou a senha estão errados';

    if (!secretary) throw new UnauthorizedException(messageError);

    if (!secretary.password) {
      throw new ConflictException('A senha desta conta ainda não foi definida');
    }

    const isValidPassword = await this.hashService.compareHash(secretary.password, pass);
    if (!isValidPassword) throw new UnauthorizedException(messageError);

    const isExpired = new Date() > new Date(secretary.dueDate);
    const isFirstLogin = secretary.lastLogin === null;

    // FIX: atualiza o timestamp sempre (antes era !isFirstLogin, causando bug)
    await this.setLoginTimestamp(secretary.id);

    const payload: TokenPayload = {
      sub: secretary.id,
      role: 'secretary',
      firstLogin: isFirstLogin,
      isExpired, // FIX: incluído no token JWT
    };

    const token = await this.jwtService.signAsync(payload);
    return { accessToken: token, firstLogin: isFirstLogin, mustChangePassword: isExpired };
  }

  async changePassword(
    newPassword: string,
    valuesSearch: number | string,
    userType: 'student' | 'secretary',
  ): Promise<void> {
    try {
      const hashedPassword = await this.hashService.hashContent(newPassword);

      if (userType === 'student') {
        await Promise.all([
          this.studentService.updateStudentPassword(String(valuesSearch), hashedPassword),
          this.studentService.updateLastLoginStudent(String(valuesSearch)),
        ]);
      } else {
        const idNumeric = Number(valuesSearch);
        if (isNaN(idNumeric)) {
          throw new Error('ID de secretária inválido para conversão numérica');
        }
        await Promise.all([
          this.secretaryService.updateSecretaryPassword(idNumeric, hashedPassword),
          this.secretaryService.updateLastLogin(idNumeric),
          this.secretaryService.updateDueDate(idNumeric),
        ]);
      }
    } catch (error) {
      console.error('Erro ao trocar senha', error);
      throw new InternalServerErrorException('Não é possível atualizar a senha');
    }
  }

  async sendForgotPasswordEmail(email: string, userType: 'student' | 'secretary') {
    let user;

    if (userType === 'student') {
      user = await this.studentService.getStudentByEmail(email);
    } else if (userType === 'secretary') {
      user = await this.secretaryService.getSecretaryByEmail(email);
    }

    if (!user) {
      return { message: 'Se o e-mail estiver cadastrado, você receberá um link em breve.' };
    }

    const secret = process.env.JWT_SECRET + user.password;
    const token = await this.jwtService.signAsync(
      { sub: user.ra || user.id, role: userType },
      { secret, expiresIn: '15h' },
    );

    // para dev
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}&id=${user.ra || user.id}&type=${userType}`;

    await this.mailService.sendResetPasswordEmail(user.email, user.name, resetUrl);
    return { message: 'E-mail enviado com sucesso.' };
  }


  async setupFirstAccess(
    ra: string,
    cpf: string,
    birthDate: string,
    newPassword: string
  ): Promise<void> {
    const student = await this.studentService.getStudentByRa(ra);
    try {
      const hashedPassword = await this.hashService.hashContent(newPassword);

      const day = birthDate.substring(0, 2);
      const month = birthDate.substring(2, 4);
      const year = birthDate.substring(4, 8);
      const formattedBirthDate = new Date(`${year}-${month}-${day}T12:00:00Z`);


      // console.log(`\n\n${birthDate}\n\n\n`)
      await this.setLoginTimestampStudent(student.ra);

      await Promise.all([
        this.studentService.updateStudentPassword(ra, hashedPassword),
        this.studentService.updateStudents({
          ra: ra,
          cpf: cpf,
          birthDate: formattedBirthDate
        }),
        this.studentService.updateLastLoginStudent(ra),
      ]);
      
    } catch (error) {
      console.error('Erro na transação de primeiro acesso do aluno:', error);
      
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      throw new InternalServerErrorException(
        'Não foi possível concluir as atualizações cadastrais do primeiro acesso.'
      );
    }
  }



  async resetPasswordWithToken(
    token: string,
    id: string | number,
    userType: 'student' | 'secretary',
    newPass: string,
  ) {
    let user;

    if (userType === 'student') {
      user = await this.studentService.getStudentByRa(String(id));
    } else if (userType === 'secretary') {
      user = await this.secretaryService.getSecretaryById(Number(id));
    }

    if (!user) throw new UnauthorizedException('Usuário inválido');

    try {
      const secret = process.env.JWT_SECRET + user.password;
      await this.jwtService.verifyAsync(token, { secret });
      await this.changePassword(newPass, id, userType);
      return { message: 'Senha redefinida com sucesso!' };
    } catch {
      throw new UnauthorizedException('Link expirado ou já utilizado.');
    }
  }

  private async setLoginTimestamp(id: number) {
    try {
      await this.secretaryService.updateLastLogin(id);
    } catch (error) {
      console.error('Erro ao atualizar último login:', error);
    }
  }

  private async setLoginTimestampStudent(ra: string) {
    try {
      await this.studentService.updateLastLoginStudent(ra);
    } catch (error) {
      console.error('Erro ao atualizar último login:', error);
    }
  }

  async sendVerificationCode(email: string) {
    const student = await this.studentService.getStudentByEmail(email);
    if (!student) throw new UnauthorizedException('Usuário não encontrado');
    return this.verificationService.sendCode(email);
  }

  async verifyCodeAndLogin(email: string, code: string) {
    const isValid = await this.verificationService.verifyCode(email, code);
    if (!isValid) throw new UnauthorizedException('Código inválido ou expirado');

    const student = await this.studentService.getStudentByEmail(email);

    const payload = {
      ra: student.ra,
      email: student.email,
    };

    const token = await this.jwtService.signAsync(payload);

    return {
      access_token: token,
      verified: true,
      user: {
        ra: student.ra,
        name: student.name,
        email: student.email,
      },
    };
  }
}
