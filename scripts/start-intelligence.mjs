import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const emulator=process.argv.includes('--emulator');
const args=process.argv.slice(2).filter(arg=>arg!=='--emulator');
const environment={...process.env,INTELLIGENCE_MODE:emulator?'emulator':'offline',VITE_INTELLIGENCE_MODE:emulator?'emulator':'offline',
VITE_FIREBASE_API_KEY:emulator?'emulator-only-key':'',VITE_FIREBASE_AUTH_DOMAIN:emulator?'demo-operations-suite-emulator.firebaseapp.com':'',
VITE_FIREBASE_PROJECT_ID:emulator?'demo-operations-suite-emulator':'',VITE_FIREBASE_APP_ID:emulator?'1:123456789012:web:operationssuiteemulator':'',
VITE_FIREBASE_USE_EMULATORS:emulator?'true':'false',VITE_ADMIN_FUNCTIONS_ENABLED:emulator?'true':'false'};
if(emulator){environment.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';environment.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';}
const child=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),...args],{cwd:process.cwd(),env:environment,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
