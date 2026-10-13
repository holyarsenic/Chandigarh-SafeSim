"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { LogIn, LogOut, ShieldCheck } from "lucide-react";

export default function SignInButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border-2 border-background bg-foreground px-3 text-background">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#E97B77]" />
        <span className="text-xs font-medium">Checking session</span>
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border-2 border-background bg-foreground pl-1.5 pr-1">
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-md border border-background object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#E97B77] text-background">
            <ShieldCheck size={16} />
          </div>
        )}

        <div className="hidden min-w-0 sm:block">
          <p className="max-w-28 truncate text-xs font-bold leading-tight text-background">
            {session.user.name ?? "Signed in"}
          </p>
          <p className="text-[10px] leading-tight text-slate-400">
            Google account
          </p>
        </div>

        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          aria-label="Sign out"
          title="Sign out"
          className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-background/20 text-background transition hover:bg-[#E97B77] hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E97B77]"
        >
          <LogOut size={15} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("google", { callbackUrl: "/" })}
      className="flex h-10 w-auto items-center gap-2 border-2 border-background bg-[#E97B77] px-3 text-background shadow-[0_3px_0_#803b39] hover:bg-[#ef918c] active:shadow-none"
    >
      <LogIn size={16} />
      <span className="whitespace-nowrap text-sm font-bold">
        Sign in with Google
      </span>
    </button>
  );
}