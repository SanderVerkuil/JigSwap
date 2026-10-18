import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { styles } from "./notification-email";

export interface InviteEmailProps {
  readonly heading: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaUrl: string;
  readonly footerText: string;
}

// The invitation email's layout: the notification email's branding (brand line, heading, one body
// paragraph, one CTA button), with a plain footer instead of the preferences link, since the
// recipient has no account to manage.
export const InviteEmail = (props: InviteEmailProps) => (
  <Html>
    <Head />
    <Preview>{props.body}</Preview>
    <Body style={styles.body}>
      <Container style={styles.container}>
        <Text style={styles.brand}>🧩 JigSwap</Text>
        <Heading as="h1" style={styles.heading}>
          {props.heading}
        </Heading>
        <Text style={styles.text}>{props.body}</Text>
        <Section>
          <Button href={props.ctaUrl} style={styles.button}>
            {props.ctaLabel}
          </Button>
        </Section>
        <Hr style={styles.hr} />
        <Text style={styles.footer}>{props.footerText}</Text>
      </Container>
    </Body>
  </Html>
);
