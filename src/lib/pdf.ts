/**
 * Turn an HTML document into a PDF the user can keep.
 *  • iOS/Android: expo-print renders a real PDF file, then the share sheet
 *    lets them save it to Files, email it, etc.
 *  • Web: expo-print can only print the current page, so the document is
 *    printed from a hidden frame; the browser's print dialog offers "Save as PDF".
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function savePdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') return printHtmlOnWeb(html, title);

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
  } else {
    await Print.printAsync({ uri });
  }
}

function printHtmlOnWeb(html: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error('Could not prepare the PDF.'));
        return;
      }
      // The PDF file name defaults to the page title in most browsers.
      const prevTitle = document.title;
      document.title = title;
      win.addEventListener('afterprint', () => {
        document.title = prevTitle;
        cleanup();
        resolve();
      });
      win.focus();
      win.print();
      // Some browsers don't fire afterprint for iframes; don't leave the caller hanging.
      setTimeout(() => {
        document.title = prevTitle;
        resolve();
      }, 1500);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
