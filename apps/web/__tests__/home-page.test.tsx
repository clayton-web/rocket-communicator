import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '../app/page';

describe('HomePage foundation shell', () => {
  it('renders the repository foundation placeholder', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { name: 'AI Communication Action Assistant' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Repository foundation is active.')).toBeInTheDocument();
    expect(screen.getByText('No product features are implemented yet.')).toBeInTheDocument();
  });
});
