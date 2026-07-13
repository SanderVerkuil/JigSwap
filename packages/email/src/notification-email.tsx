import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface NotificationEmailProps {
  readonly heading: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly ctaUrl: string;
  readonly footerText: string;
  readonly footerLinkLabel: string;
  readonly footerLinkUrl: string;
}

const styles = {
  body: {
    backgroundColor: "#f5f5f4",
    fontFamily: "Helvetica, Arial, sans-serif",
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    margin: "24px auto",
    padding: "32px",
    maxWidth: "480px",
  },
  brand: { fontSize: "20px", fontWeight: 700 as const, margin: "0 0 24px" },
  heading: { fontSize: "18px", fontWeight: 600 as const, margin: "0 0 12px" },
  text: {
    fontSize: "14px",
    lineHeight: "22px",
    color: "#333333",
    margin: "0 0 24px",
  },
  button: {
    backgroundColor: "#1d4ed8",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600 as const,
    padding: "10px 20px",
    textDecoration: "none",
  },
  hr: { borderColor: "#e7e5e4", margin: "32px 0 16px" },
  footer: {
    fontSize: "12px",
    lineHeight: "18px",
    color: "#78716c",
    margin: "0",
  },
};

// The single shared layout for all JigSwap notification emails: brand line, heading, one body
// paragraph, one CTA button, and the mandatory preferences footer. Per-type variation lives in
// the copy catalog, not in components.
export const NotificationEmail = (props: NotificationEmailProps) => (
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
        <Text style={styles.footer}>
          {props.footerText}{" "}
          <Link href={props.footerLinkUrl}>{props.footerLinkLabel}</Link>
        </Text>
      </Container>
    </Body>
  </Html>
);
