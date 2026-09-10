import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWindChimeDisplayClient } from '../../../src/client/live';
import { WindChimeLiveDisplay } from '../../../src/broadcast/Display';
import { assetTransport, transport } from './bridge';
const client = createWindChimeDisplayClient({ transport: transport(window.windchimeOutput), assetTransport: assetTransport(window.windchimeOutput) });
function Output() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => window.windchimeOutput.onBlank(() => setGeneration(value => value + 1)), []);
  return <WindChimeLiveDisplay key={generation} client={client} pollIntervalMs={500} />;
}
createRoot(document.getElementById('root')!).render(<Output />);
