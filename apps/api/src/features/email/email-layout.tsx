/* eslint-disable shadcn/no-inline-styles, shadcn/no-unknown-classes -- Email clients require inline styles; these classes carry media-query overrides. */
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

export const palette = {
  background: "#f6f5f7",
  border: "#e8e6ea",
  foreground: "#171619",
  muted: "#68666e",
  white: "#ffffff",
} as const;

const font = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const EmailFrame = ({
  children,
  preview,
}: {
  readonly children: ReactNode;
  readonly preview: string;
}) => (
  <Html lang="en">
    <Head>
      <style>{`@media only screen and (max-width: 480px) {
        .email-card { padding: 32px 24px !important; }
        .email-heading { font-size: 24px !important; line-height: 30px !important; }
        .email-action { max-width: none !important; }
      }`}</style>
    </Head>
    <Preview>{preview}</Preview>
    <Body
      style={{
        backgroundColor: palette.background,
        color: palette.foreground,
        fontFamily: font,
        margin: 0,
        padding: "32px 16px",
      }}
    >
      <Container
        className="email-card"
        style={{
          backgroundColor: palette.white,
          border: `1px solid ${palette.border}`,
          borderRadius: 12,
          boxSizing: "border-box",
          margin: "0 auto",
          maxWidth: 576,
          padding: 40,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: 600,
            lineHeight: "24px",
            margin: 0,
          }}
        >
          Meal Planner
        </Text>
        <Hr style={{ borderColor: palette.border, margin: "24px 0 32px" }} />
        {children}
        <Hr style={{ borderColor: palette.border, margin: "28px 0 24px" }} />
        <Text
          style={{
            color: palette.muted,
            fontSize: 12,
            lineHeight: "18px",
            margin: 0,
          }}
        >
          Meal Planner
          <br />
          A little less planning. A lot more time together.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const Action = ({
  label,
  url,
}: {
  readonly label: string;
  readonly url: string;
}) => (
  <>
    <Section style={{ margin: "32px 0 28px" }}>
      <Button
        className="email-action"
        href={url}
        style={{
          backgroundColor: palette.foreground,
          borderRadius: 24,
          boxSizing: "border-box",
          color: palette.white,
          display: "block",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: "20px",
          maxWidth: 240,
          padding: "14px 20px",
          textAlign: "center",
          textDecoration: "none",
          width: "100%",
        }}
      >
        {label}
      </Button>
    </Section>
    <Text
      style={{
        color: palette.muted,
        fontSize: 13,
        lineHeight: "20px",
        margin: "0 0 8px",
      }}
    >
      If the button does not work, copy this link into your browser:
    </Text>
    <Text
      style={{
        fontSize: 13,
        lineHeight: "20px",
        margin: 0,
        overflowWrap: "anywhere",
      }}
    >
      <Link href={url} style={{ color: palette.foreground }}>
        {url}
      </Link>
    </Text>
  </>
);

export const headingStyle = {
  fontSize: 28,
  fontWeight: 600,
  letterSpacing: "-0.03em",
  lineHeight: "34px",
  margin: "0 0 18px",
} as const;

export const bodyStyle = {
  color: palette.muted,
  fontSize: 15,
  lineHeight: "24px",
  margin: 0,
} as const;

export const noteStyle = {
  color: palette.muted,
  fontSize: 13,
  lineHeight: "20px",
  margin: "28px 0 0",
} as const;
