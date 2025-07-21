import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { ChevronRight, LucideIcon } from "lucide-react";
import Link from "next/link";

export type Item = {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  items?: {
    title: string;
    url: string;
  }[];
};

function MenuItem({ title, url, isActive, items, ...props }: Item) {
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
                  <span className="truncate leading-right">
                    <Link href={subItem.url}>{subItem.title}</Link>
                  </span>
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
      <SidebarMenuButton tooltip={title}>
        {props.icon && <props.icon />}
        <span className="truncate leading-right">
          <Link href={url}>{title}</Link>
        </span>
      </SidebarMenuButton>
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
