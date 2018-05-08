import 'jest';
import { gitConfig } from './git';

test('finds core.bare', async () => {
    expect(await gitConfig('core.bare')).toMatch(/true|false/);

});