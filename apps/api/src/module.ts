import { Controller, Get, Module } from '@nestjs/common';
import { Pipeline, PipelineController } from './pipeline';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'api', publishing: 'simulation' };
  }
}

@Module({
  controllers: [AppController, PipelineController],
  providers: [Pipeline],
})
export class AppModule {}
