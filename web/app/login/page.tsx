import { LoginForm } from './login-form.tsx';

export default function LoginPage() {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-lg font-semibold">Inloggen — Check de Cijfers</h1>
      <p className="text-sm text-zinc-500">
        Vul je e-mailadres in; je krijgt een inloglink toegestuurd. Geen wachtwoord nodig.
      </p>
      <LoginForm />
    </div>
  );
}
