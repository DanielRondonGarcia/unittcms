import { createRequire } from 'node:module';

const { Get, Route, Tags } = createRequire(import.meta.url)('tsoa/dist/index.js') as typeof import('tsoa');

@Route('')
@Tags('index')
export class IndexController {
  /**
   * Root endpoint to verify API server is running
   * @summary API root endpoint
   */
  @Get('/')
  public async getIndex(): Promise<{ message: string }> {
    return {
      message: 'Welcome to the UnitTCMS API!',
    };
  }
}
