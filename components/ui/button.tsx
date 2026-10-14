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
      whileHover={{ scale: 1.03, rotate: 1 }}
      whileTap={{ scale: 0.97, rotate: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 18 }}
      className={`flex  w-auto items-center gap-2 border-2 border-background bg-background px-3 text-background shadow-[0_3px_0_#64B5F6] hover:bg-background/90 active:shadow-none cursor-pointer ${className}`}
    >
      <span className="flex gap-2 whitespace-nowrap text-sm font-bold font-['Gochi_Hand',cursive] text-foreground">
        {children ?? label}
      </span>
    </motion.button>
  );
}