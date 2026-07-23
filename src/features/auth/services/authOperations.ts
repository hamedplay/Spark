import { supabase } from '../../../lib/supabase';

export interface PasswordAuthCredentials {
  email: string;
  password: string;
}

export interface SignUpWithPasswordInput
  extends PasswordAuthCredentials {
  emailRedirectTo: string;
}

export async function getCurrentAuthUserId():
  Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function signUpWithPassword(
  input: SignUpWithPasswordInput
): Promise<string | null> {
  const { data, error } =
    await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo:
          input.emailRedirectTo,
      },
    });

  if (error) {
    throw error;
  }

  return data.user?.id ?? null;
}

export async function signInWithPassword(
  credentials: PasswordAuthCredentials
): Promise<string | null> {
  const { data, error } =
    await supabase.auth
      .signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

  if (error) {
    throw error;
  }

  return data.user?.id ?? null;
}
