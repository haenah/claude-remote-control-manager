import * as React from "react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/animate-ui/components/radix/alert-dialog";
import { Button } from "@/components/animate-ui/components/buttons/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";
import { Input } from "./ui";

/** A confirm step — wrapping a trigger, or controlled via open/onOpenChange. */
export function Confirm({
  children,
  open,
  onOpenChange,
  title,
  description,
  action = "Confirm",
  destructive = true,
  onConfirm,
}: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  action?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent className="bg-card max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "bg-destructive hover:bg-destructive/90 text-white" : undefined}
            onClick={onConfirm}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A one-field form in a dialog (rename, …). */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  initial = "",
  placeholder,
  action = "Save",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initial?: string;
  placeholder?: string;
  action?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  React.useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return;
            onSubmit(value.trim());
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Input autoFocus value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
          <DialogFooter>
            <Button type="submit" disabled={!value.trim()}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
