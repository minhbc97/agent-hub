import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { HubProvider } from '@/lib/hub';
import { queryClient } from '@/lib/query';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider disableTransitionOnChange attribute="class" defaultTheme="dark" enableSystem={false}>
        <TooltipProvider>
          <HubProvider>
            <App />
            <Toaster />
          </HubProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
