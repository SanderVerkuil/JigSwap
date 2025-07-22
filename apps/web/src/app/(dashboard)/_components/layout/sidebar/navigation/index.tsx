import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronRight, LucideIcon } from "lucide-react";
import Link from "next/link";

export type Item = {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  action?: {
    title: string;
    url: string;
    icon: LucideIcon;
  };
  items?: {
    title: string;
    url: string;
  }[];
};

function Action({
  title,
  url,
  ...props
}: {
  title: string;
  url: string;
  icon: LucideIcon;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuAction asChild>
          <Link href={url}>
            <props.icon />
            <span className="sr-only">{title}</span>
          </Link>
        </SidebarMenuAction>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function MenuItem({ title, url, isActive, items, action, ...props }: Item) {
  if (undefined !== items) {
    <Collapsible
      key={title}
      asChild
      defaultOpen={isActive}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={title}>
            {props.icon && <props.icon />}
            <span>{title}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton asChild>
                  <Link href={subItem.url}>
                    <span className="truncate leading-right">
                      {subItem.title}
                    </span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>;
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={title} asChild>
        <Link href={url}>
          {props.icon && <props.icon />}
          <span className="truncate leading-right">{title}</span>
        </Link>
      </SidebarMenuButton>

      {action && <Action {...action} />}
    </SidebarMenuItem>
  );
}

export function Navigation({ items }: { items: Item[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Navigation</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <MenuItem key={`menu-item-${item.title}`} {...item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
