
import {
  Sheet as SheetPrimitive,
  SheetTrigger as SheetTriggerPrimitive,
  SheetOverlay as SheetOverlayPrimitive,
  SheetClose as SheetClosePrimitive,
  SheetPortal as SheetPortalPrimitive,
  SheetContent as SheetContentPrimitive,
  SheetHeader as SheetHeaderPrimitive,
  SheetFooter as SheetFooterPrimitive,
  SheetTitle as SheetTitlePrimitive,
  SheetDescription as SheetDescriptionPrimitive,
  type SheetProps as SheetPrimitiveProps,
  type SheetTriggerProps as SheetTriggerPrimitiveProps,
  type SheetOverlayProps as SheetOverlayPrimitiveProps,
  type SheetCloseProps as SheetClosePrimitiveProps,
  type SheetContentProps as SheetContentPrimitiveProps,
  type SheetHeaderProps as SheetHeaderPrimitiveProps,
  type SheetFooterProps as SheetFooterPrimitiveProps,
  type SheetTitleProps as SheetTitlePrimitiveProps,
  type SheetDescriptionProps as SheetDescriptionPrimitiveProps,
  useSheet,
} from '@/components/animate-ui/primitives/radix/sheet';
import { cn } from '@/lib/utils';
import { XIcon } from 'lucide-react';
import { useDragControls, type PanInfo } from 'motion/react';
import * as React from 'react';

type SheetProps = SheetPrimitiveProps;

function Sheet(props: SheetProps) {
  return <SheetPrimitive {...props} />;
}

type SheetTriggerProps = SheetTriggerPrimitiveProps;

function SheetTrigger(props: SheetTriggerProps) {
  return <SheetTriggerPrimitive {...props} />;
}

type SheetOverlayProps = SheetOverlayPrimitiveProps;

function SheetOverlay({ className, ...props }: SheetOverlayProps) {
  return (
    <SheetOverlayPrimitive
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

type SheetCloseProps = SheetClosePrimitiveProps;

function SheetClose(props: SheetCloseProps) {
  return <SheetClosePrimitive {...props} />;
}

type SheetContentProps = SheetContentPrimitiveProps & {
  showCloseButton?: boolean;
};

// A bottom sheet closes by dragging its handle down past this distance, or flicking it.
const DISMISS_OFFSET = 120;
const DISMISS_VELOCITY = 500;

// Set inside a swipeable sheet: starts the dismiss drag from a pointer-down, so the header can act as the handle too.
const SheetDragContext = React.createContext<((e: React.PointerEvent) => void) | null>(null);

function SheetContent({
  className,
  children,
  side = 'right',
  // Bottom sheets close by swiping the handle instead.
  showCloseButton = side !== 'bottom',
  ...props
}: SheetContentProps) {
  const { setIsOpen } = useSheet();
  const dragControls = useDragControls();
  const swipeable = side === 'bottom';
  const startDrag = React.useCallback((e: React.PointerEvent) => dragControls.start(e), [dragControls]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) setIsOpen(false);
  };
  return (
    <SheetPortalPrimitive>
      <SheetOverlay />
      <SheetContentPrimitive
        className={cn(
          'bg-background fixed z-50 flex flex-col gap-4 shadow-lg',
          side === 'right' && 'h-full w-[350px] border-l',
          side === 'left' && 'h-full w-[350px] border-r',
          side === 'top' && 'w-full h-[350px] border-b',
          side === 'bottom' && 'w-full h-[350px] border-t',
          className,
        )}
        side={side}
        {...(swipeable && {
          drag: 'y' as const,
          dragControls,
          dragListener: false,
          dragConstraints: { top: 0, bottom: 0 },
          dragElastic: { top: 0, bottom: 1 },
          // Radix's and motion's onDragEnd types collide in the merged props; this one is motion's.
          onDragEnd: onDragEnd as unknown as SheetContentProps['onDragEnd'],
        })}
        {...props}
      >
        {swipeable && (
          <div
            aria-hidden
            onPointerDown={startDrag}
            className="sticky top-0 z-10 -mb-3 flex shrink-0 cursor-grab touch-none justify-center bg-inherit pt-2.5 pb-3 active:cursor-grabbing"
          >
            <div className="bg-muted-foreground/30 h-1 w-10 rounded-full" />
          </div>
        )}
        <SheetDragContext.Provider value={swipeable ? startDrag : null}>{children}</SheetDragContext.Provider>
        {showCloseButton && (
          <SheetClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        )}
      </SheetContentPrimitive>
    </SheetPortalPrimitive>
  );
}

type SheetHeaderProps = SheetHeaderPrimitiveProps;

function SheetHeader({ className, ...props }: SheetHeaderProps) {
  const startDrag = React.useContext(SheetDragContext);
  return (
    <SheetHeaderPrimitive
      className={cn('flex flex-col gap-1.5 p-4', startDrag && 'cursor-grab touch-none select-none active:cursor-grabbing', className)}
      onPointerDown={startDrag ?? undefined}
      {...props}
    />
  );
}

type SheetFooterProps = SheetFooterPrimitiveProps;

function SheetFooter({ className, ...props }: SheetFooterProps) {
  return (
    <SheetFooterPrimitive
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

type SheetTitleProps = SheetTitlePrimitiveProps;

function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <SheetTitlePrimitive
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  );
}

type SheetDescriptionProps = SheetDescriptionPrimitiveProps;

function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return (
    <SheetDescriptionPrimitive
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetProps,
  type SheetTriggerProps,
  type SheetCloseProps,
  type SheetContentProps,
  type SheetHeaderProps,
  type SheetFooterProps,
  type SheetTitleProps,
  type SheetDescriptionProps,
};
