import { useEffect, useState } from 'react';
import { Icon } from '../design/Icon';
import { ModelsView } from './ModelsView';
import { GenerationView } from './GenerationView';
import { PageTransition } from '../components/PageTransition';
import { APP_VERSION } from '../version';

export function SettingsView({ initialTab = 'models' }: { initialTab?: 'models' | 'work' }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  return (
    <div className="n-settings">
      <header className="n-settings-head"><h1 className="n-panel-title">Settings</h1><p className="n-panel-sub">Your voice models and a record of the audio you make.</p>
        <div className="n-settings-tabs" role="tablist" aria-label="Settings">
          <button type="button" role="tab" id="settings-models" aria-selected={tab === 'models'} aria-controls="settings-content" className={`pill${tab === 'models' ? ' pill-primary' : ''}`} onClick={() => setTab('models')}><Icon name="models" size={16} />Models</button>
          <button type="button" role="tab" id="settings-work" aria-selected={tab === 'work'} aria-controls="settings-content" className={`pill${tab === 'work' ? ' pill-primary' : ''}`} onClick={() => setTab('work')}><Icon name="history" size={16} />Work history</button>
        </div>
      </header>
      <div id="settings-content" className="n-settings-content" role="tabpanel" aria-labelledby={`settings-${tab}`}><PageTransition viewKey={tab} position={tab === 'models' ? 0 : 1}>{tab === 'models' ? <ModelsView /> : <GenerationView />}</PageTransition></div>
      <p className="n-settings-build">Narrate {APP_VERSION}</p>
    </div>
  );
}
