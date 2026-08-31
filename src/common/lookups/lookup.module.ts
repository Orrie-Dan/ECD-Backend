import { Global, Module } from '@nestjs/common';
import { LookupResolverService } from './lookup-resolver.service';

@Global()
@Module({
  providers: [LookupResolverService],
  exports: [LookupResolverService],
})
export class LookupModule {}
