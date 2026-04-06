import { motion } from 'motion/react';
import { useState, useEffect } from 'react';

export default function LoadingScreen() {
  const [stage, setStage] = useState<'loading' | 'running'>('loading');

  useEffect(() => {
    const timer = setTimeout(() => setStage('running'), 2000);
    return () => clearTimeout(timer);
  }, []);

  const armVariants = {
    run: { rotate: [20, -20, 20] },
  };
  const legVariants = {
    run: { rotate: [30, -30, 30] },
  };

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      className="fixed inset-0 bg-white flex flex-col items-center justify-center z-[100]"
    >
      {stage === 'loading' ? (
        <motion.div
          animate={{ y: [0, -20, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
          className="text-4xl font-bold text-[#2c4261]"
        >
          Loading...
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full h-48 flex items-center overflow-hidden"
        >
          {/* Cartoon Human Character */}
          <motion.div
            initial={{ x: -150 }}
            animate={{ x: "100vw", y: [0, -15, 0] }}
            transition={{ 
              x: { duration: 3, repeat: Infinity, ease: "linear" },
              y: { duration: 0.4, repeat: Infinity, ease: "easeInOut" }
            }}
            className="absolute"
          >
            <svg width="100" height="120" viewBox="0 0 100 120">
              {/* Head */}
              <circle cx="50" cy="30" r="20" fill="#FFD700" />
              {/* Body */}
              <rect x="40" y="50" width="20" height="30" rx="5" fill="#4169E1" />
              {/* Arms */}
              <motion.path d="M40 55 L25 75" stroke="#FFD700" strokeWidth="6" strokeLinecap="round" variants={armVariants} animate="run" transition={{ duration: 0.4, repeat: Infinity }} />
              <motion.path d="M60 55 L75 75" stroke="#FFD700" strokeWidth="6" strokeLinecap="round" variants={armVariants} animate="run" transition={{ duration: 0.4, repeat: Infinity, delay: 0.2 }} />
              {/* Legs */}
              <motion.path d="M45 80 L40 110" stroke="#4169E1" strokeWidth="6" strokeLinecap="round" variants={legVariants} animate="run" transition={{ duration: 0.4, repeat: Infinity }} />
              <motion.path d="M55 80 L60 110" stroke="#4169E1" strokeWidth="6" strokeLinecap="round" variants={legVariants} animate="run" transition={{ duration: 0.4, repeat: Infinity, delay: 0.2 }} />
            </svg>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}
