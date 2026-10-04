import AuthGate from '../AuthGate';
import AuthorProfile from '../AuthorProfile';

export default function AuthorPage() {
  return (
    <AuthGate>
      <AuthorProfile />
    </AuthGate>
  );
}
