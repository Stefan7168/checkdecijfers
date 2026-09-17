"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

// PATCHED from shadcn's generated `@/components/ui/button` alias: tsc/Next
// resolve that path alias natively, but Vite/vitest do not (no
// vite-tsconfig-paths plugin, no resolve.alias in web/vitest.config.ts), so
// it was repointed to this relative import. This is the ONLY cross-ui/-file
// import in this directory — no other ui/*.tsx file imports a sibling file
// (they import only `cn` from the real npm package plus external packages)
// — so re-running `npx shadcn add dialog` will regenerate the `@/...` alias
// here and this one-line fix will need to be re-applied.
import { Button } from "./button.tsx"
import { XIcon } from "lucide-react"
// Session 110 UX audit pass 3, row 7: the × below used to hardcode the
// English word "Close" regardless of language — every modal in the Dutch UI
// announced "Close" as its last accessible name. useT() is the same
// client-side language hook every other component reads from
// lib/i18n/lang-provider.tsx (app/layout.tsx wraps the whole tree in a
// LangProvider; an isolated unit test with no provider above it gets the
// 'nl' default, matching the app's own default). A SECOND hand-patched
// import alongside the Button one above — a future `npx shadcn add dialog`
// regen will need BOTH re-applied, not just the one the older comment names.
import { useT } from "../../lib/i18n/lang-provider.tsx"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** Session 110 UX audit pass 3, row 7: was a hardcoded English "Close" —
   * now reads the shared catalogue key (common.close) via the ambient
   * client-side language context by default. A caller that already threads
   * its OWN `lang` prop explicitly (chart.tsx/chart-embed-dialog.tsx's
   * documented "no ambient LangProvider dependency" convention, via
   * ChartEditModal) passes its own `t(lang, 'common.close')` here instead,
   * so the × always matches that surface's chosen language even when no
   * LangProvider wraps the test/render tree — the ambient useT() fallback
   * below is for a (today hypothetical) plain consumer of DialogContent
   * that relies on the page-wide LangProvider the way most of the app does. */
  closeLabel?: string
}) {
  // Session 110 UX audit pass 3, row 7: was a hardcoded English "Close" —
  // now reads the same catalogue key (common.close) every other close
  // control in the app uses, via the shared client-side language context —
  // unless a caller overrides it with its own already-resolved `closeLabel`
  // (see that prop's own comment above).
  const t = useT()
  const resolvedCloseLabel = closeLabel ?? t('common.close')
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{resolvedCloseLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
