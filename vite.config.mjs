import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createIntelligenceHandler,emulatorProvider} from './data-science/server/intelligence-api.mjs';
export default defineConfig({
  server:{host:'127.0.0.1',watch:{ignored:['**/.cache/**','**/data-science/artifacts/**']},fs:{deny:['.env','.env.*','**/.git/**','**/.cache/**','**/data-science/artifacts/**','**/data-science/data/**','**/functions/**']}},
  plugins:[react(),{name:'local-intelligence-api',async configureServer(server){
    const mode=process.env.INTELLIGENCE_MODE||'disabled';
    const provider=mode==='emulator'?await emulatorProvider():{};
    server.middlewares.use(createIntelligenceHandler({mode,verifyToken:provider.verifyToken,controlledProvider:provider.controlled,accountsProvider:provider.accounts}));
  }}]
});
