import 'dotenv/config';
import { createApp } from './web.js';
import { storageMode } from './store.js';

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`🌴 Web app sur http://localhost:${PORT}  (stockage : ${storageMode})`);
});
