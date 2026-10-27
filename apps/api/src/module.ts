import { Controller, Get, Module } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'api', publishing: 'simulation' };
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}
