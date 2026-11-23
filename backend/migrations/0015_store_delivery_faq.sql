UPDATE editorial_faq
SET question = 'Como funciona a entrega?',
    answer = 'Entrega pela loja. Fale com a Mascavo para combinar as condições e o prazo da entrega.',
    revision = lower(hex(randomblob(16))),
    updated_at = unixepoch()
WHERE id = '00000000-0000-4000-8000-000000000002'
  AND revision = 'initial';
