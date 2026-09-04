/**
 * @deprecated Use `npm run seed:admin` — seeds both admin and survey_sync users.
 */
import { execSync } from 'child_process';

execSync('npm run seed:admin', { stdio: 'inherit' });
