import type { MeResponse } from '@shared/types';
import { useState } from 'react';
import { Tabs } from '../../components/ui';
import ReportView from './ReportView';
import RosterView from './RosterView';
import StaffView from './StaffView';
import StoresView from './StoresView';
import TodayView from './TodayView';

type View = 'today' | 'roster' | 'report' | 'staff' | 'stores';

export default function AdminPage({ me }: { me: MeResponse }) {
  const [view, setView] = useState<View>('today');
  return (
    <div className="stack">
      <Tabs<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'today', label: 'วันนี้' },
          { value: 'roster', label: 'ตารางกะ' },
          { value: 'report', label: 'รายงาน' },
          { value: 'staff', label: 'พนักงาน' },
          { value: 'stores', label: 'สาขา' },
        ]}
      />
      {view === 'today' && <TodayView />}
      {view === 'roster' && <RosterView />}
      {view === 'report' && <ReportView />}
      {view === 'staff' && <StaffView meId={me.me!.id} />}
      {view === 'stores' && <StoresView />}
    </div>
  );
}
