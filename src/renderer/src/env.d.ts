/// <reference types="vite/client" />

import type { GConverterApi } from '@shared/ipc'

declare global {
  interface Window {
    gconverter: GConverterApi
    gconverterDrop: {
      getPathForFile(file: File): string
    }
  }
}

export {}
