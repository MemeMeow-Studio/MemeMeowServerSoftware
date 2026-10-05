import { effectScope } from "vue"
import { useImageClipboard } from "mememeow-image-clipboard"

window.desktopImageCopy = effectScope().run(() => useImageClipboard().copyImage)
