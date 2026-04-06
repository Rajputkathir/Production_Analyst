import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';

interface LogoRendererProps {
  logoUrl: string;
  className?: string;
  size: number;
}

export const LogoRenderer: React.FC<LogoRendererProps> = ({ logoUrl, className, size }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!logoUrl) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = logoUrl;

    img.onload = () => {
      const aspectRatio = img.width / img.height;
      const width = size;
      const height = size / aspectRatio;
      
      canvas.width = width;
      canvas.height = height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width, height);
    };
  }, [logoUrl, size]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: 'easeInOut' }}
      className={className}
      style={{ width: size, height: size }}
    >
      <canvas 
        ref={canvasRef} 
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </motion.div>
  );
};
