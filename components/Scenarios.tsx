
"use client";

import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

export type ScenarioItem = {
  id: string;
  name: string;
  description: string;
  status: "Available" | "Coming Soon" | string;
  icon: LucideIcon;
};

type ScenarioSelectorProps = {
  scenarios: readonly ScenarioItem[];
  scenario: string;
  onScenarioChange: (id: string) => void;
};

export default function ScenarioSelector({
  scenarios,
  scenario,
  onScenarioChange,
}: ScenarioSelectorProps) {
  return (
    <motion.div
      className="space-y-2"
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}>
      {scenarios.map((item) => {
        const Icon = item.icon;
        const isActive = scenario === item.id;
        const isAvailable = item.status === "Available";

        return (
          <motion.button
            key={item.id}
            type="button"
            disabled={!isAvailable}
            onClick={() => onScenarioChange(item.id)}
            variants={{
              hidden: { opacity: 0, y: 2 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.3, ease: "easeOut" },
              },
            }}
            whileHover={ isAvailable ? { scale: 1.01, transition: { duration: 0.18 } } : "" }
            whileTap={isAvailable ? { scale: 0.985 } : ""}
            animate={{
              backgroundColor: isActive ? "#274546" : "#ffffff",
            }}
            transition={{
              backgroundColor: { duration: 0.18, ease: "easeInOut" },
              borderColor: { duration: 0.18, ease: "easeInOut" },
            }}
            className={`relative w-full overflow-hidden border border-r-4 border-r-black border-b-4 border-b-black p-3 text-left shadow-sm ${
              isActive
                ? "cursor-pointer"
                : isAvailable
                  ? "cursor-pointer hover:bg-white/80"
                  : "cursor-not-allowed bg-slate-100 opacity-60"
            }`}>

            <div className="relative z-10 flex items-start gap-3">
              <motion.div
                animate={{
                  backgroundColor: isActive ? "#93a2a3" : "#f1f5f9",
                  color: isActive ? "#111" : "#64748b",
                }}
                transition={{duration: 0.18, ease:"easeInOut"}}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              >
                <Icon size={20} />
              </motion.div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold ${ isActive ? "text-foreground" : "text-slate-800" }`}>
                    {item.name}
                  </span>

                  <motion.span
                    layout
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isAvailable
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {item.status}
                  </motion.span>
                </div>

                <p className={`mt-1 text-xs leading-5 ${ isActive ? "text-foreground" : "text-slate-800" }`}>
                  {item.description}
                </p>
              </div>
            </div>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
