import { Controller, Get, Module } from '@nestjs/common';
import { Pipeline, PipelineController } from './pipeline';
import { APP_GUARD } from '@nestjs/core';
import { ApiGuard } from './security';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'api', publishing: 'simulation' };
  }
}

@Module({
  controllers: [AppController, PipelineController],
  providers: [Pipeline, { provide: APP_GUARD, useClass: ApiGuard }],
})
export class AppModule {}
