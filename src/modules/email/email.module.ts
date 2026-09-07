import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SmtpEmailService } from './smtp-email.service';

@Module({
  providers: [SmtpEmailService, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
