import AuthGate from '../AuthGate';
import AgentBoard from '../AgentBoard';

export default function AgentPage() {
  return (
    <AuthGate>
      <AgentBoard />
    </AuthGate>
  );
}
