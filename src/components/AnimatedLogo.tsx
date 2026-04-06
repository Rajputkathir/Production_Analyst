import React from 'react';
import { motion } from 'motion/react';
import { LogoRenderer } from './LogoRenderer';

interface AnimatedLogoProps {
  logoUrl: string;
  companyName: string;
  size: number;
  className?: string;
  textClassName?: string;
  isVisible: boolean;
}

export const AnimatedLogo: React.FC<AnimatedLogoProps> = ({ 
  logoUrl, 
  companyName, 
  size, 
  className,
  textClassName,
  isVisible
}) => {
  return (
    <div className={className}>
      {logoUrl ? (
        <LogoRenderer 
          logoUrl={logoUrl} 
          size={size} 
          className="shrink-0 flex items-center justify-center overflow-hidden" 
        />
      ) : (
        <div className="w-10 h-10 bg-brand-2 rounded-lg flex items-center justify-center text-xl shadow-lg shadow-brand-2/20 shrink-0">
          📊
        </div>
      )}
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: 'easeOut' }}
          className={textClassName}
        >
          {companyName.toUpperCase()}
        </motion.div>
      )}
    </div>
  );
};
