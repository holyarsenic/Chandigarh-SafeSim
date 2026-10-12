"use client";

import { motion } from "motion/react";
import React from "react";

type ButtonProps = {
  className?: string;
  label?: string;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  children?: React.ReactNode;
};

export default function Button({
  className = "",
  label = "Submit",
  onClick,
  type = "button",
  disabled = false,
  children,
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.03, y: -4, rotate: 1 }}
      whileTap={{ scale: 0.97, y: 3, rotate: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 18 }}
      className={`w-full cursor-pointer rounded-lg border-0 text-base shadow-[0_6px_0_#111] active:shadow-[0_1px_0_#111] disabled:cursor-not-allowed disabled:opacity-50 transition-shadow ${className}`}
    >
      <span className="flex items-center justify-center gap-2 rounded-lg border-[3px] border-foreground bg-background px-3 py-1 font-['Gochi_Hand',cursive] text-foreground">
        {children ?? label}
      </span>
    </motion.button>
  );
}